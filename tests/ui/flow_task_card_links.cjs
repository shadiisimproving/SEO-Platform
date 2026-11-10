// By hand, as a hurried person: the whole card opens a task, pages and keywords link it, and it shows where it's linked.
// Runs against the real app on the demo world, with sign-in (made-up data only; updated 2026-11-10 from the sample screens):
//   DB_NAME_TEST=test_fixc_test .venv/bin/python tests/ui/app_server.py --port 8283 --login
// Usage: node tests/ui/flow_task_card_links.cjs [base url] [folder for screenshots]
const fs = require("fs");
const { open, menu } = require("./pw.cjs");
const base = process.argv[2] || "http://127.0.0.1:8283/";
const shots = process.argv[3] || "var/ui-task-card-links";
fs.mkdirSync(shots, { recursive: true });
const results = [];
const check = (name, ok, extra = "") => { results.push(ok); console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? ` (${extra})` : ""}`); };
const RUN = Date.now().toString(36);
const TITLE = `Rewrite the made-up checkout page ${RUN}`, LINKED = `Improve the moulin à café page ${RUN}`;
// Two of the demo world's tracked keywords on site-one.example: one gets a task here, one never does.
const KW = "moulin à café", KW_FREE = "how to brew coffee";

(async () => {
  const { browser, page, problems } = await open({ width: 1440, height: 900 });
  page.setDefaultTimeout(8000);
  const missing = [];
  page.on("response", (r) => { if (r.status() >= 400) missing.push(`${r.status()} ${r.url()}`); });
  const panelOpen = async () => (await page.locator("#task-form").count()) > 0;
  const settle = () => page.waitForTimeout(350);
  const esc = async () => { await page.keyboard.press("Escape"); await settle(); };

  await page.goto(`${base}login`);
  await page.fill("#email", "admin@example.com"); await page.fill("#password", "demo-password-1"); await page.click("#go");
  await page.waitForTimeout(2500);
  // A task of our own, with a site, a type, an owner and a due date, so the card has every part to click.
  const made = await page.evaluate(async (title) => {
    const me = await (await fetch("api/auth/me")).json();
    const sites = (await (await fetch("api/links/sites")).json()).sites;
    const due = new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10);
    const r = await fetch("api/tasks", { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": me.csrf }, body: JSON.stringify({ title, status: "todo", priority: "high", kind: "Content", owner_label: "Demo admin", due, site_id: sites.find((s) => s.host === "site-one.example")?.id ?? null }) });
    return r.status;
  }, TITLE);
  check("a made-up task to work with", made === 201 || made === 200, made);
  await page.goto(`${base}?r=${RUN}#tasks`);
  await page.waitForSelector("[data-task-card]");
  await settle();
  await page.screenshot({ path: `${shots}/board.png` });

  const card = page.locator("[data-task-card]").filter({ hasText: TITLE }).first();
  const parts = [["tags row", ".tk-tags"], ["foot", ".tk-foot-start"], ["title", ".tk-title"]];
  if (await card.locator(".status").count()) parts.unshift(["status", ".status >> nth=-1"]);
  for (const [name, part] of parts) {
    await card.locator(part).first().click();
    await settle();
    check(`clicking the card's ${name} opens the task`, await panelOpen());
    await esc();
    check(`  Esc closes it`, !(await panelOpen()));
  }
  const box = await card.boundingBox();
  await page.mouse.click(box.x + box.width - 5, box.y + 5);
  await settle();
  check("clicking a blank corner opens the task", await panelOpen());
  await page.screenshot({ path: `${shots}/task-open.png` });
  check("More details is gone", (await page.locator("#task-hypothesis, #task-note, #task-estimate, #task-spent, details.fold").count()) === 0);
  check("Importance is gone and Priority stays", (await page.locator("#task-impact").count()) === 0 && (await page.locator("#task-priority").count()) === 1);
  check("no name to type on a comment", (await page.locator("#tk-comment-name").count()) === 0);
  await esc();

  await card.hover();
  await page.waitForTimeout(250);
  await card.locator(".tk-move").click();
  await settle();
  check("the status list doesn't open the task", !(await panelOpen()));
  await page.keyboard.press("Escape");
  await settle();

  await card.locator(".tk-tags").first().dblclick();
  await page.waitForTimeout(500);
  check("a double click leaves the task open", await panelOpen());
  await esc();

  await card.locator(".tk-title").focus();
  await page.keyboard.press("Enter");
  await settle();
  check("Enter on the title opens it", await panelOpen());
  await esc();

  const id = await card.getAttribute("data-task-card");
  await card.dragTo(page.locator('[data-task-col="doing"]'));
  await page.waitForTimeout(800);
  check("dragging moves the card and doesn't open it", (await page.locator(`[data-task-col="doing"] [data-task-card="${id}"]`).count()) === 1 && !(await panelOpen()));

  // A new task, linked by hand.
  await page.locator(".topbar [data-task-new]").click();
  await settle();
  await page.locator("#task-title").fill(LINKED);
  await page.locator("#task-site").selectOption({ label: "site-one.example" });
  await page.locator("#task-keywords-add").fill(KW);
  await page.keyboard.press("Enter");
  await settle();
  check("Enter makes a chip and doesn't save", (await page.locator('[data-links="task-keywords"] .tk-chip').count()) === 1 && (await panelOpen()));
  await page.locator("#task-keywords-add").fill(KW.toUpperCase());
  await page.keyboard.press("Enter");
  check("the same word in capitals isn't added twice", (await page.locator('[data-links="task-keywords"] .tk-chip').count()) === 1);
  await page.locator("#task-keywords-add").fill("visa a, visa b");
  await page.keyboard.press("Enter");
  check("commas make several", (await page.locator('[data-links="task-keywords"] .tk-chip').count()) === 3);
  await page.locator('[data-links="task-keywords"] .tk-chip-x').last().click();
  await page.locator('[data-links="task-keywords"] .tk-chip-x').last().click();
  check("x removes one", (await page.locator('[data-links="task-keywords"] .tk-chip').count()) === 1);
  await page.waitForTimeout(800);
  check("suggestions follow the site", (await page.locator("#task-keywords-options option").count()) > 0, `${await page.locator("#task-keywords-options option").count()} suggestions`);
  await page.locator("#task-pages-add").fill("https://site-one.example/moulins-guide");
  await page.locator("#task-form").screenshot({ path: `${shots}/task-form-filled.png` });
  // Esc mid-form keeps it all as a draft.
  await esc();
  await page.locator(".topbar [data-task-new]").click();
  await settle();
  check("Esc mid-form: the draft comes back with its chips", (await page.locator('[data-links="task-keywords"] .tk-chip').count()) === 1 && (await page.locator("#task-pages-add").inputValue()).includes("moulins-guide"));
  // Save with the page still typed in the box.
  await page.locator("#task-save").click();
  await page.waitForTimeout(800);
  check("what's left in the box is saved too", !(await panelOpen()));

  // It shows when the keyword is opened (the real Keywords screen, found with its search box).
  const openKeyword = async (words) => {
    await page.goto(`${base}?k=${Date.now()}#keywords?site=site-one.example&q=${encodeURIComponent(words)}`);
    await page.waitForSelector("#kw-table [data-kwr-open]", { timeout: 15000 });
    await page.locator("#kw-table [data-kwr-open]").filter({ hasText: new RegExp(`^${words}$`, "i") }).first().click();
    await page.waitForSelector("#panel .panel-foot", { timeout: 10000 });
    await page.waitForTimeout(600);
  };
  await openKeyword(KW);
  const rel = page.locator("#panel .tk-related");
  check("opening the keyword shows the task", (await rel.locator(`text=${LINKED}`).count()) === 1);
  await page.locator("#panel").screenshot({ path: `${shots}/keyword-panel.png` });
  await rel.locator(".tk-rel-title").filter({ hasText: LINKED }).first().click();
  await settle();
  check("clicking it opens the task, links filled in", await panelOpen() && (await page.locator('[data-links="task-pages"] .tk-chip').first().innerText()).includes("moulins-guide"));
  await page.locator("#tk-comment").fill("Started on this");
  await page.locator("#tk-comment-send").click();
  await page.waitForTimeout(800);
  const said = await page.locator(".tk-thread li").first().innerText();
  check("a comment carries the account's name", said.includes("Demo admin"), said.replace(/\n/g, " | "));
  await esc();
  // A keyword with no task shows nothing.
  await openKeyword(KW_FREE);
  check("a keyword with no task shows nothing", (await page.locator("#panel .tk-related h3").count()) === 0);
  // Starting from a keyword links it by itself.
  await page.locator("#panel .panel-foot [data-task-find]").click();
  await settle();
  const pages = await page.locator('[data-links="task-pages"] .tk-chip').count();
  check("a task made from a keyword starts linked", (await page.locator('[data-links="task-keywords"] .tk-chip').count()) === 1 && pages <= 1, `${pages} page`);
  await page.locator("[data-discard-panel]").click();
  await settle();

  // Table, phone, dark.
  await page.goto("about:blank");
  await page.goto(`${base}?t=2#tasks`);
  await page.waitForSelector("[data-task-card]");
  await page.locator('[data-task-view="table"]').click();
  await settle();
  await page.locator("[data-task-row] td[data-label]").nth(2).click();
  await settle();
  check("clicking a table row opens the task", await panelOpen());
  await esc();
  await page.screenshot({ path: `${shots}/table.png` });
  await page.locator('[data-task-view="kanban"]').click();
  await settle();
  await menu(page, "theme");
  await settle();
  await page.screenshot({ path: `${shots}/board-dark.png` });
  await page.locator("[data-task-card]").first().click();
  await settle();
  await page.screenshot({ path: `${shots}/task-dark.png` });
  await esc();
  await menu(page, "theme");
  await menu(page, "lang");
  await settle();
  await page.screenshot({ path: `${shots}/board-fr.png` });
  await menu(page, "lang");
  await settle();
  await page.setViewportSize({ width: 390, height: 800 });
  await settle();
  const wide = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  check("no sideways scroll on a phone", !wide);
  await page.screenshot({ path: `${shots}/board-phone.png` });
  await page.locator("[data-task-card] .tk-tags").first().click();
  await settle();
  check("phone: the card opens the task", await panelOpen());
  await page.screenshot({ path: `${shots}/task-phone.png` });
  await page.setViewportSize({ width: 1000, height: 800 });
  await esc();

  const real = problems.filter((p) => !p.includes("Failed to load resource"));
  console.log("     not found:", [...new Set(missing)].slice(0, 6).join(" , "));
  check("no page errors", real.length === 0, real.slice(0, 5).join(" || "));
  await browser.close();
  console.log(`${results.filter(Boolean).length} of ${results.length} passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
