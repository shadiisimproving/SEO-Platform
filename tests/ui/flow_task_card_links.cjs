// By hand, as a hurried person: the whole card opens a task, pages and keywords link it, and it shows where it's linked.
// Usage: node tests/ui/flow_task_card_links.cjs [base url] [folder for screenshots]
const { open } = require("./pw.cjs");
const base = process.argv[2] || "http://127.0.0.1:8201/index.html";
const shots = process.argv[3] || ".";
const results = [];
const check = (name, ok, extra = "") => { results.push(ok); console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? ` (${extra})` : ""}`); };

(async () => {
  const { browser, page, problems } = await open({ width: 1440, height: 900 });
  const missing = [];
  page.on("response", (r) => { if (r.status() >= 400) missing.push(`${r.status()} ${r.url()}`); });
  const panelOpen = async () => (await page.locator("#task-form").count()) > 0;
  const settle = () => page.waitForTimeout(350);
  const esc = async () => { await page.keyboard.press("Escape"); await settle(); };
  await page.goto(`${base}#tasks`);
  await page.waitForSelector("[data-task-card]");
  await settle();
  await page.screenshot({ path: `${shots}/board.png` });

  const card = page.locator("[data-task-card]").filter({ hasText: "Looks fixed" }).first();
  for (const [name, part] of [["Looks fixed", ".status >> nth=-1"], ["tags row", ".tk-tags"], ["foot", ".tk-foot-start"], ["title", ".tk-title"]]) {
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
  await page.locator("#task-form").screenshot({ path: `${shots}/task-form.png` });
  check("More details is gone", (await page.locator("#task-hypothesis, #task-note, #task-estimate, #task-spent, details.fold").count()) === 0);
  check("Importance is gone and Priority stays", (await page.locator("#task-impact").count()) === 0 && (await page.locator("#task-priority").count()) === 1);
  check("no name to type on a comment", (await page.locator("#tk-comment-name").count()) === 0);
  console.log("     comment label:", await page.locator(".tk-comments label.field span").first().innerText());
  await esc();

  await card.hover();
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${shots}/card-hover.png`, clip: { x: box.x - 8, y: box.y - 8, width: box.width + 16, height: box.height + 16 } });
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
  await settle();
  check("dragging moves the card and doesn't open it", (await page.locator(`[data-task-col="doing"] [data-task-card="${id}"]`).count()) === 1 && !(await panelOpen()));

  // A new task, linked by hand.
  await page.locator(".topbar [data-task-new]").click();
  await settle();
  await page.locator("#task-title").fill("Improve the emirates id page");
  await page.locator("#task-site").selectOption({ label: "site-one.example" });
  await page.locator("#task-keywords-add").fill("emirates id");
  await page.keyboard.press("Enter");
  await settle();
  check("Enter makes a chip and doesn't save", (await page.locator('[data-links="task-keywords"] .tk-chip').count()) === 1 && (await panelOpen()));
  await page.locator("#task-keywords-add").fill("Emirates ID");
  await page.keyboard.press("Enter");
  check("the same word in capitals isn't added twice", (await page.locator('[data-links="task-keywords"] .tk-chip').count()) === 1);
  await page.locator("#task-keywords-add").fill("visa a, visa b");
  await page.keyboard.press("Enter");
  check("commas make several", (await page.locator('[data-links="task-keywords"] .tk-chip').count()) === 3);
  await page.locator('[data-links="task-keywords"] .tk-chip-x').last().click();
  await page.locator('[data-links="task-keywords"] .tk-chip-x').last().click();
  check("x removes one", (await page.locator('[data-links="task-keywords"] .tk-chip').count()) === 1);
  check("suggestions follow the site", (await page.locator("#task-keywords-options option").count()) > 0, `${await page.locator("#task-keywords-options option").count()} suggestions`);
  await page.locator("#task-pages-add").fill("https://www.site-one.example/emirates-id");
  await page.locator("#task-form").screenshot({ path: `${shots}/task-form-filled.png` });
  // Esc mid-form keeps it all as a draft.
  await esc();
  await page.locator(".topbar [data-task-new]").click();
  await settle();
  check("Esc mid-form: the draft comes back with its chips", (await page.locator('[data-links="task-keywords"] .tk-chip').count()) === 1 && (await page.locator("#task-pages-add").inputValue()).includes("emirates-id"));
  // Save with the page still typed in the box.
  await page.locator("#task-save").click();
  await page.waitForTimeout(500);
  check("what's left in the box is saved too", !(await panelOpen()));

  // It shows when the keyword is opened.
  await page.evaluate(() => { location.hash = "#keywords"; });
  await page.waitForTimeout(600);
  const rows = page.locator("[data-open-kw]");
  await page.locator('[data-open-kw="emirates id"]').first().click();
  await settle();
  const rel = page.locator("#panel .tk-related");
  check("opening the keyword shows the task", (await rel.locator("text=Improve the emirates id page").count()) === 1);
  await page.locator("#panel").screenshot({ path: `${shots}/keyword-panel.png` });
  await rel.locator(".tk-rel-title").first().click();
  await settle();
  check("clicking it opens the task, links filled in", await panelOpen() && (await page.locator('[data-links="task-pages"] .tk-chip').first().innerText()).includes("emirates-id"));
  await page.locator('#tk-comment').fill("Started on this");
  await page.locator("#tk-comment-send").click();
  await settle();
  const said = await page.locator(".tk-thread li").first().innerText();
  check("a comment carries the account's name", said.includes("Malik"), said.replace(/\n/g, " | "));
  await esc();
  // A keyword with no task shows nothing.
  await page.locator('[data-open-kw="coût de la vie dubaï"]').first().click();
  await settle();
  check("a keyword with no task shows nothing", (await page.locator("#panel .tk-related h3").count()) === 0);
  await esc();

  // Starting from a keyword links it by itself.
  await page.locator('[data-open-kw="coût de la vie dubaï"]').first().click();
  await settle();
  await page.locator("#panel .panel-foot [data-task-find]").click();
  await settle();
  check("a task made from a keyword starts linked", (await page.locator('[data-links="task-keywords"] .tk-chip').count()) === 1 && (await page.locator('[data-links="task-pages"] .tk-chip').count()) === 1);
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
  await page.locator('[data-mock="theme"]').first().click();
  await settle();
  await page.screenshot({ path: `${shots}/board-dark.png` });
  await page.locator('[data-task-card]').first().click();
  await settle();
  await page.screenshot({ path: `${shots}/task-dark.png` });
  await esc();
  await page.locator('[data-mock="theme"]').first().click();
  await page.locator('[data-mock="lang"]').first().click();
  await settle();
  await page.screenshot({ path: `${shots}/board-fr.png` });
  await page.locator('[data-mock="lang"]').first().click();
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
  await settle();
  await page.screenshot({ path: `${shots}/board-1000.png` });

  // A sample served as plain files has no logo service behind it, so those 404s say nothing.
  const real = problems.filter((p) => !p.includes("Failed to load resource"));
  console.log("     not found:", [...new Set(missing)].slice(0, 6).join(" , "));
  check("no page errors", real.length === 0, real.slice(0, 5).join(" || "));
  await browser.close();
  console.log(`${results.filter(Boolean).length} of ${results.length} passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
